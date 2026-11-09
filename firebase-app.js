import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, createUserWithEmailAndPassword, deleteUser, setPersistence, inMemoryPersistence } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const authMessage = document.getElementById("authMessage");
const adminMessage = document.getElementById("adminFormMessage");
const firebaseReady = isFirebaseConfigured;
let auth, db, functions;
let stopClientProfileListener = () => {};
let stopClientTransactionsListener = () => {};
function addIdentityInputs() {
  const form = document.getElementById("createClientForm");
  if (!form || document.getElementById("newClientPassportNumber")) return;
  const fieldset = document.createElement("fieldset");
  fieldset.id = "clientIdentityFields";
  fieldset.className = "mb-5 rounded-xl border border-slate-200 p-4";
  fieldset.innerHTML = `<legend class="px-1 text-xs font-bold text-slate-800">Client identity details</legend>
    <p class="mb-4 text-[10px] leading-4 text-amber-800">For this HSBC-branded simulation, enter fictional test details only.</p>
    <label class="mb-3 block text-xs font-semibold">Passport number<input id="newClientPassportNumber" required maxlength="40" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <label class="mb-3 block text-xs font-semibold">Registered address<input id="newClientRegisteredAddress" required maxlength="200" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <div class="mb-3 grid grid-cols-2 gap-3"><label class="block text-xs font-semibold">Phone number<input id="newClientPhoneNumber" required type="tel" maxlength="32" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
    <label class="block text-xs font-semibold">Citizenship<input id="newClientCitizenship" required maxlength="80" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label></div>
    <label class="block text-xs font-semibold">Passport issue date<input id="newClientPassportIssueDate" required type="date" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>`;
  const expiryLabel = document.createElement("label");
  expiryLabel.className = "mb-5 block text-xs font-semibold";
  expiryLabel.innerHTML = `Card expiration<input id="newClientCardExpiry" required type="month" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"><span class="mt-1 block text-[10px] font-normal text-slate-400">Fictional demo card only.</span>`;
  document.getElementById("newClientCardNumber").closest("label").after(expiryLabel);
  document.getElementById("adminFormMessage").before(fieldset);
  const expiryInput = document.getElementById("newClientCardExpiry");
  const now = new Date();
  expiryInput.min = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

addIdentityInputs();

function organizeClientCreationForm() {
  const form = document.getElementById("createClientForm");
  if (!form || form.dataset.organized === "true") return;
  const intro = form.firstElementChild;
  const authFields = ["newClientName", "newClientEmail", "newClientPassword"].map(id => document.getElementById(id).closest("label"));
  const balanceGroup = document.getElementById("newClientBalance").parentElement.parentElement;
  const cardFields = [document.getElementById("newClientCardNumber").closest("label"), document.getElementById("newClientCardExpiry").closest("label")];
  const identity = document.getElementById("clientIdentityFields");
  const message = document.getElementById("adminFormMessage");
  const submit = document.getElementById("createClientSubmit");
  const buildSection = (title, fields) => {
    const section = document.createElement("fieldset");
    section.className = "mb-4 rounded-xl border border-slate-200 p-4";
    const legend = document.createElement("legend");
    legend.className = "px-1 text-xs font-bold text-slate-700";
    legend.textContent = title;
    section.append(legend, ...fields);
    return section;
  };
  identity.className = "mb-4 rounded-xl border border-slate-200 p-4";
  form.replaceChildren(
    intro,
    buildSection("1. Client sign-in", authFields),
    buildSection("2. Initial account and card", [balanceGroup, ...cardFields]),
    identity,
    message,
    submit
  );
  form.dataset.organized = "true";
}

organizeClientCreationForm();

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

function addAccountTools() {
  const anchor = document.getElementById("balanceMessage");
  if (!anchor || document.getElementById("adminAccountsPanel")) return;
  const panel = document.createElement("section");
  panel.id = "adminAccountsPanel";
  panel.className = "mt-6 border-t border-slate-200 pt-5";
  panel.innerHTML = `<div class="mb-4"><h5 class="text-sm font-semibold">Add a client account or IBAN</h5><p class="mt-1 text-xs text-slate-500">Select a client first, then choose “International IBAN account” in Account type.</p></div>
    <form id="addClientAccountForm" class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label class="block text-xs font-semibold">Account name<input id="newAccountName" required maxlength="50" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" placeholder="Travel account"></label>
      <label class="block text-xs font-semibold">Account type<select id="newAccountType" class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option>Checking</option><option>Savings</option><option>Current</option><option>Foreign currency</option><option value="International IBAN">International IBAN account (no card)</option></select></label>
      <label class="block text-xs font-semibold">Currency<select id="newAccountCurrency" class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option>USD</option><option>EUR</option><option>GBP</option></select></label>
      <label class="block text-xs font-semibold">Opening balance<input id="newAccountBalance" required type="number" min="0" max="1000000" step="0.01" value="0.00" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label>
      <div id="newCardFields" class="space-y-3 sm:col-span-2"><label class="block text-xs font-semibold">Fictional card number<input id="newAccountCardNumber" required inputmode="numeric" maxlength="23" pattern="[0-9 ]{12,23}" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" placeholder="0000 0000 0000 0000"></label>
      <label class="block text-xs font-semibold">Card expiration<input id="newAccountExpiry" required type="month" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"></label></div>
      <label id="newIbanField" class="hidden block text-xs font-semibold sm:col-span-2">Fictional IBAN<input id="newAccountIban" maxlength="42" autocomplete="off" class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm uppercase" placeholder="GB15 HBUK 4012 7612 345"><span class="mt-1 block text-[10px] font-normal text-amber-800">Example format only. Use invented details; this simulation cannot send or receive transfers.</span></label>
      <p id="accountBuilderMessage" class="hidden text-xs leading-5 sm:col-span-2" role="status"></p>
      <button class="rounded-lg bg-[#db0011] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#b8000e] sm:col-span-2">Add account</button>
    </form>
    <div id="adminAccountsList" class="mt-4 space-y-3"></div>`;
  anchor.after(panel);
  const now = new Date();
  document.getElementById("newAccountExpiry").min = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  document.getElementById("newAccountType").addEventListener("change", () => {
    const ibanMode = document.getElementById("newAccountType").value === "International IBAN";
    document.getElementById("newCardFields").classList.toggle("hidden", ibanMode);
    document.getElementById("newIbanField").classList.toggle("hidden", !ibanMode);
    document.getElementById("newAccountCardNumber").required = !ibanMode;
    document.getElementById("newAccountExpiry").required = !ibanMode;
    document.getElementById("newAccountIban").required = ibanMode;
  });
}

addAccountTools();

function organizeAdminEditor() {
  const editor = document.getElementById("balanceEditor");
  if (!editor || editor.dataset.organized === "true") return;
  const balanceForm = document.getElementById("balanceForm");
  const balanceMessage = document.getElementById("balanceMessage");
  const accountsPanel = document.getElementById("adminAccountsPanel");
  const activityPanel = document.getElementById("adminTransactionPanel");
  const documentsPanel = document.getElementById("adminDocumentForm")?.parentElement;
  if (!balanceForm || !balanceMessage || !accountsPanel || !activityPanel || !documentsPanel) return;

  const tabs = [
    { id: "overview", label: "Overview", icon: "layout-dashboard", title: "Account overview", hint: "Set the main demo account balance and currency." },
    { id: "accounts", label: "Accounts & IBAN", icon: "landmark", title: "Accounts & IBAN", hint: "Add accounts and adjust each displayed balance." },
    { id: "activity", label: "Activity", icon: "arrow-left-right", title: "Transactions", hint: "Add or remove demo income and expense entries." },
    { id: "documents", label: "Documents", icon: "files", title: "Client documents", hint: "Manage synthetic PDF files for this client." }
  ];
  const tabBar = document.createElement("div");
  tabBar.className = "mb-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 sm:grid-cols-4";
  tabBar.setAttribute("role", "tablist");
  tabBar.setAttribute("aria-label", "Selected client settings");
  const content = document.createElement("div");
  content.className = "space-y-4";
  const contentMap = {};

  tabs.forEach((tab, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-editor-tab flex items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-[11px] font-semibold transition";
    button.dataset.tab = tab.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === 0));
    button.innerHTML = `<i data-lucide="${tab.icon}" class="h-4 w-4"></i><span>${tab.label}</span>`;
    button.addEventListener("click", () => selectAdminEditorTab(tab.id));
    tabBar.append(button);

    const panel = document.createElement("section");
    panel.dataset.panel = tab.id;
    panel.setAttribute("role", "tabpanel");
    if (index !== 0) panel.classList.add("hidden");
    panel.innerHTML = `<div class="mb-3"><h5 class="text-sm font-semibold text-slate-800">${tab.title}</h5><p class="mt-1 text-xs leading-5 text-slate-500">${tab.hint}</p></div>`;
    contentMap[tab.id] = panel;
    content.append(panel);
  });

  contentMap.overview.append(balanceForm, balanceMessage);
  contentMap.accounts.append(accountsPanel);
  contentMap.activity.append(activityPanel);
  contentMap.documents.append(documentsPanel);
  accountsPanel.className = "space-y-4";
  activityPanel.className = "space-y-4";
  documentsPanel.className = "rounded-xl border border-slate-200 bg-white p-4";
  editor.dataset.organized = "true";
  editor.append(tabBar, content);
  const deleteClientButton = document.createElement("button");
  deleteClientButton.type = "button";
  deleteClientButton.id = "deleteSelectedClient";
  deleteClientButton.className = "mt-5 rounded-lg border border-rose-200 px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50";
  deleteClientButton.textContent = "Delete client account";
  deleteClientButton.addEventListener("click", deleteSelectedClient);
  editor.append(deleteClientButton);
  const workspaceGrid = editor.closest(".grid.items-start");
  if (workspaceGrid) workspaceGrid.after(editor);
  editor.className = "hidden mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";
  selectAdminEditorTab("overview");
  if (window.lucide) window.lucide.createIcons();
}

async function deleteSelectedClient() {
  const uid = document.getElementById("selectedClientUid").value;
  const name = document.getElementById("selectedClientName").textContent;
  const email = document.getElementById("selectedClientEmail").textContent;
  if (!uid || !functions) return;
  const confirmation = window.prompt(`This permanently deletes ${name} (${email}), including their sign-in, profile, accounts and activity. Type DELETE to confirm.`);
  if (confirmation !== "DELETE") return;
  const button = document.getElementById("deleteSelectedClient");
  button.disabled = true;
  button.textContent = "Deleting account…";
  try {
    await httpsCallable(functions, "deleteClientAccount")({ uid });
    document.getElementById("balanceEditor").classList.add("hidden");
    document.getElementById("selectedClientUid").value = "";
    window.setAdminWorkspaceMode?.("list");
    await loadClients();
    showToast("Client account and associated data deleted.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete client account";
    showToast(friendlyError(error));
  }
}

function selectAdminEditorTab(tabId) {
  const editor = document.getElementById("balanceEditor");
  if (!editor) return;
  editor.querySelectorAll(".admin-editor-tab").forEach(button => {
    const active = button.dataset.tab === tabId;
    button.setAttribute("aria-selected", String(active));
    button.classList.toggle("bg-white", active);
    button.classList.toggle("text-slate-900", active);
    button.classList.toggle("shadow-sm", active);
    button.classList.toggle("text-slate-500", !active);
  });
  editor.querySelectorAll("[data-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.panel !== tabId));
}

organizeAdminEditor();

function setupAdminWorkspace() {
  const portal = document.getElementById("adminPortal");
  const form = document.getElementById("createClientForm");
  const grid = form?.parentElement;
  const listCard = document.getElementById("clientList")?.closest(".rounded-2xl");
  const editor = document.getElementById("balanceEditor");
  if (!portal || !form || !grid || !listCard || !editor || portal.dataset.workspaceReady) return;
  portal.dataset.workspaceReady = "true";
  grid.className = "space-y-5";
  form.classList.add("hidden");
  listCard.className = "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm";
  portal.querySelector(".mb-6.grid.gap-4.sm\\:grid-cols-3")?.classList.add("hidden");
  const pageHeading = portal.querySelector("h2");
  if (pageHeading) pageHeading.textContent = "Clients";

  const controls = document.createElement("div");
  controls.className = "mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-100 bg-gradient-to-r from-white via-white to-rose-50 p-4 shadow-sm sm:p-5";
  controls.innerHTML = `<div class="flex items-center gap-3"><span class="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-700"><i data-lucide="users-round" class="h-5 w-5"></i></span><div><p class="text-[10px] font-bold uppercase tracking-[.14em] text-rose-700">Client workspace</p><p id="adminWorkspaceTitle" class="mt-0.5 text-sm font-semibold text-slate-900">Client list</p><p id="adminWorkspaceHint" class="mt-1 text-xs text-slate-500">Choose a client to manage their accounts, activity and profile.</p></div></div><button id="adminCreateClient" type="button" class="inline-flex items-center gap-2 rounded-lg bg-[#db0011] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#b8000e]"><i data-lucide="plus" class="h-4 w-4"></i>Create client</button>`;
  grid.before(controls);

  const setMode = mode => {
    const title = document.getElementById("adminWorkspaceTitle");
    const hint = document.getElementById("adminWorkspaceHint");
    const createButton = document.getElementById("adminCreateClient");
    const isCreate = mode === "create";
    const isClient = mode === "client";
    form.classList.toggle("hidden", !isCreate);
    listCard.classList.toggle("hidden", isCreate);
    editor.classList.toggle("hidden", !isClient);
    title.textContent = isCreate ? "Create a client" : isClient ? document.getElementById("selectedClientName").textContent : "Client list";
    hint.textContent = isCreate ? "Enter sign-in details, then configure the client's account and profile." : isClient ? document.getElementById("selectedClientEmail").textContent : "Choose a client to manage their accounts, activity and profile.";
    createButton.classList.toggle("hidden", isClient);
    createButton.innerHTML = isCreate
      ? `<i data-lucide="arrow-left" class="h-4 w-4"></i>Back to clients`
      : `<i data-lucide="plus" class="h-4 w-4"></i>Create client`;
    if (window.lucide) window.lucide.createIcons();
  };
  document.getElementById("adminCreateClient").addEventListener("click", () => setMode(form.classList.contains("hidden") ? "create" : "list"));
  const back = document.createElement("button");
  back.type = "button";
  back.className = "mb-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900";
  back.innerHTML = `<i data-lucide="arrow-left" class="h-4 w-4"></i>Back to clients`;
  back.addEventListener("click", () => setMode("list"));
  editor.before(back);
  back.classList.add("hidden");
  const updateBack = () => back.classList.toggle("hidden", editor.classList.contains("hidden"));
  const observer = new MutationObserver(updateBack);
  observer.observe(editor, { attributes: true, attributeFilter: ["class"] });
  if (window.lucide) window.lucide.createIcons();
  window.setAdminWorkspaceMode = setMode;
}

setupAdminWorkspace();

function showMessage(el, message, kind = "error") {
  el.textContent = message;
  el.classList.remove("hidden", "text-rose-700", "text-emerald-700");
  el.classList.add(kind === "success" ? "text-emerald-700" : "text-rose-700");
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("functions/not-found") || code.includes("functions/unavailable")) return "Client deletion is not enabled yet. Firebase requires the project to use the Blaze plan and deploy the deleteClientAccount function.";
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
    panel.innerHTML = `<div class="mb-4 flex items-center gap-3"><span class="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-700"><i data-lucide="contact-round" class="h-5 w-5"></i></span><div><h2 class="font-semibold">Personal information</h2><p class="mt-1 text-xs text-slate-500">Details provided for this simulated account</p></div></div><dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2"><div><dt class="text-[11px] text-slate-400">Full name</dt><dd data-identity="fullName" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Email address</dt><dd data-identity="email" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Passport number</dt><dd data-identity="passportNumber" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Registered address</dt><dd data-identity="registeredAddress" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Phone number</dt><dd data-identity="phoneNumber" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Passport issue date</dt><dd data-identity="passportIssueDate" class="mt-1 break-words text-sm font-medium">—</dd></div><div><dt class="text-[11px] text-slate-400">Citizenship</dt><dd data-identity="citizenship" class="mt-1 break-words text-sm font-medium">—</dd></div></dl><div class="mt-6 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3"><div class="rounded-xl bg-slate-50 p-4"><p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Profile status</p><p class="mt-2 flex items-center gap-2 text-xs font-semibold text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-500"></span>Account active</p></div><div class="rounded-xl bg-slate-50 p-4"><p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sign-in security</p><p class="mt-2 text-xs font-semibold text-slate-700">Password protected</p></div><div class="rounded-xl bg-slate-50 p-4"><p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Support</p><button id="profileManagerHelp" class="mt-2 text-xs font-semibold text-brand-700">Contact account manager →</button></div></div><p class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900">Simulation account: all profile and account details are fictional. This is not a live banking service.</p>`;
    const heading = settings.querySelector(".mb-7");
    settings.replaceChildren(...(heading ? [heading, panel] : [panel]));
  }
  const values = { fullName: record.displayName, email: record.email, ...(record.identity || {}) };
  panel.querySelectorAll("[data-identity]").forEach(item => {
    const value = values[item.dataset.identity];
    item.textContent = value ? String(value) : "Not provided";
  });
  if (window.lucide) window.lucide.createIcons();
  panel.querySelector("#profileManagerHelp")?.addEventListener("click", () => window.openManagerChat?.());
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
      row.className = "client-list-row group flex w-full items-center gap-3 border-b border-slate-100 px-5 py-4 text-left transition last:border-0 hover:bg-rose-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-300";
      row.dataset.uid = client.uid;
      row.dataset.search = `${client.displayName || ""} ${client.email || ""}`.toLowerCase();
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
      const manage = document.createElement("span");
      manage.className = "ml-2 inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-rose-700";
      manage.innerHTML = `Manage <span aria-hidden="true">→</span>`;
      row.append(avatar, detail, card, balance, manage);
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
    let adjustedAccountId = "checking";
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
      const profile = accountSnapshot.data();
      const accounts = normalizeAccounts(profile).map(account => ({ ...account }));
      const targetId = currentTransaction.accountId || "checking";
      adjustedAccountId = targetId;
      const targetAccount = accounts.find(account => account.id === targetId);
      if (!targetAccount) throw new Error("The account linked to this transaction no longer exists.");
      updatedBalance = Math.round((Number(targetAccount.balance || 0) + balanceChange) * 100) / 100;
      if (updatedBalance < 0) throw new Error("The balance cannot be adjusted safely. Update the client's balance before deleting this income.");
      targetAccount.balance = updatedBalance;
      const update = { accounts, updatedAt: serverTimestamp() };
      if (targetId === "checking") update.checkingBalance = updatedBalance;
      firestoreTransaction.update(accountRef, update);
      firestoreTransaction.delete(transactionRef);
    });
    if (adjustedAccountId === "checking") document.getElementById("editClientBalance").value = updatedBalance.toFixed(2);
    showMessage(message, "Transaction deleted and account balance adjusted.", "success");
    const updated = await getDoc(doc(db, "users", uid));
    if (updated.exists()) renderAdminAccounts(uid, normalizeAccounts(updated.data()));
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
  selectAdminEditorTab("overview");
  document.querySelectorAll(".client-list-row").forEach(row => {
    const selected = row.dataset.uid === client.uid;
    row.classList.toggle("bg-rose-50", selected);
    row.classList.toggle("hover:bg-slate-50", !selected);
    row.setAttribute("aria-pressed", String(selected));
  });
  document.getElementById("balanceEditor").classList.remove("hidden");
  document.getElementById("selectedClientName").textContent = client.displayName || "Client";
  document.getElementById("selectedClientEmail").textContent = client.email || "";
  document.getElementById("selectedClientUid").value = client.uid;
  document.getElementById("editClientBalance").value = Number(client.checkingBalance || 0).toFixed(2);
  document.getElementById("editClientCurrency").value = client.currency || "USD";
  document.getElementById("balanceMessage").classList.add("hidden");
  document.getElementById("transactionFormMessage").classList.add("hidden");
  window.setAdminWorkspaceMode?.("client");
  loadAdminTransactions(client.uid);
  renderAdminAccounts(client.uid, normalizeAccounts(client));
  document.getElementById("balanceEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function normalizeAccounts(record) {
  if (Array.isArray(record.accounts) && record.accounts.length) return record.accounts;
  return [{
    id: "checking",
    name: "Personal account",
    type: "Checking",
    currency: record.currency || "USD",
    balance: Number(record.checkingBalance || 0),
    cardNumber: String(record.cardNumber || ""),
    cardLast4: record.cardLast4 || String(record.cardNumber || "").slice(-4),
    cardExpiry: record.cardExpiry || ""
  }];
}

function renderAdminAccounts(uid, accounts) {
  const container = document.getElementById("adminAccountsList");
  if (!container) return;
  container.replaceChildren();
  accounts.forEach(account => {
    const row = document.createElement("div");
    row.className = "rounded-xl border border-slate-200 bg-white p-4";
    const heading = document.createElement("div");
    heading.className = "flex flex-wrap items-center justify-between gap-2";
    const name = document.createElement("p");
    name.className = "text-xs font-semibold";
    name.textContent = account.iban
      ? `${account.name} · International IBAN ${account.iban}`
      : `${account.name} · ${account.type} ···· ${account.cardLast4 || "----"}`;
    const balance = document.createElement("p");
    balance.className = "text-xs font-semibold text-slate-700";
    balance.textContent = new Intl.NumberFormat("en-US", { style: "currency", currency: account.currency || "USD" }).format(Number(account.balance || 0));
    heading.append(name, balance);
    const controls = document.createElement("div");
    controls.className = "mt-3 flex flex-wrap gap-2";
    const amount = document.createElement("input");
    amount.type = "number"; amount.min = "0.01"; amount.max = "1000000"; amount.step = "0.01"; amount.placeholder = "Amount";
    amount.className = "min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs";
    for (const [label, direction] of [["Add funds", 1], ["Withdraw", -1]]) {
      const button = document.createElement("button");
      button.type = "button"; button.className = direction > 0
        ? "rounded-lg bg-emerald-700 px-3 py-2 text-[10px] font-semibold text-white hover:bg-emerald-800"
        : "rounded-lg border border-slate-300 px-3 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-50";
      button.textContent = label;
      button.addEventListener("click", () => adjustClientAccount(uid, account.id, amount.value, direction, button));
      controls.append(button);
    }
    controls.prepend(amount);
    row.append(heading, controls);
    container.append(row);
  });
}

async function adjustClientAccount(uid, accountId, rawAmount, direction, button) {
  const amount = Number(rawAmount);
  const message = document.getElementById("accountBuilderMessage");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return showMessage(message, "Enter an amount from 0.01 to 1,000,000.");
  button.disabled = true;
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, "users", uid);
      const transactionRef = doc(collection(db, "users", uid, "transactions"));
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("The selected client account no longer exists.");
      const profile = snap.data();
      const accounts = normalizeAccounts(profile).map(account => ({ ...account }));
      const account = accounts.find(item => item.id === accountId);
      if (!account) throw new Error("The account no longer exists.");
      const nextBalance = Math.round((Number(account.balance || 0) + direction * amount) * 100) / 100;
      if (nextBalance < 0) throw new Error("The withdrawal is greater than this account's balance.");
      account.balance = nextBalance;
      const update = { accounts, updatedAt: serverTimestamp() };
      if (accountId === "checking") update.checkingBalance = nextBalance;
      tx.update(ref, update);
      const today = new Date();
      today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
      tx.set(transactionRef, {
        type: direction > 0 ? "income" : "expense",
        counterparty: "Account adjustment",
        description: `${direction > 0 ? "Funds added to" : "Funds withdrawn from"} ${account.name}`,
        amount: Math.round(amount * 100) / 100,
        currency: account.currency || "USD",
        accountId,
        date: today.toISOString().slice(0, 10),
        status: "Completed",
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
    });
    showMessage(message, direction > 0 ? "Funds added to this demo account." : "Funds withdrawn from this demo account.", "success");
    await loadClients();
    const updated = await getDoc(doc(db, "users", uid));
    if (updated.exists()) renderAdminAccounts(uid, normalizeAccounts(updated.data()));
    await loadAdminTransactions(uid);
  } catch (error) { showMessage(message, friendlyError(error)); }
  finally { button.disabled = false; }
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
      accounts: [{
        id: "checking",
        name: "Personal account",
        type: "Checking",
        currency: profile.currency,
        balance: Math.round(profile.checkingBalance * 100) / 100,
        cardNumber,
        cardLast4: cardNumber.slice(-4),
        cardExpiry: profile.cardExpiry
      }],
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
    window.setAdminWorkspaceMode?.("list");
  } catch (error) { showMessage(adminMessage, friendlyError(error)); }
  finally { submit.disabled = false; submit.textContent = "Create demo account"; }
});

document.getElementById("balanceForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("balanceMessage");
  const uid = document.getElementById("selectedClientUid").value;
  const nextBalance = Number(document.getElementById("editClientBalance").value);
  if (!Number.isFinite(nextBalance) || nextBalance < 0 || nextBalance > 1_000_000) return showMessage(message, "Enter a balance from 0 to 1,000,000.");
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, "users", uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("The selected client account no longer exists.");
      const accounts = normalizeAccounts(snap.data()).map(account => account.id === "checking" ? { ...account, balance: Math.round(nextBalance * 100) / 100, currency: document.getElementById("editClientCurrency").value } : account);
      tx.update(ref, {
        checkingBalance: Math.round(nextBalance * 100) / 100,
        currency: document.getElementById("editClientCurrency").value,
        accounts,
        updatedAt: serverTimestamp()
      });
    });
    showMessage(message, "Account balance updated.", "success");
    const updated = await getDoc(doc(db, "users", uid));
    if (updated.exists()) renderAdminAccounts(uid, normalizeAccounts(updated.data()));
    await loadClients();
  } catch (error) { showMessage(message, friendlyError(error)); }
});

document.getElementById("addClientAccountForm").addEventListener("submit", async event => {
  event.preventDefault();
  const uid = document.getElementById("selectedClientUid").value;
  const message = document.getElementById("accountBuilderMessage");
  if (!uid) return showMessage(message, "Select a client first.");
  const isIban = document.getElementById("newAccountType").value === "International IBAN";
  const rawCardNumber = document.getElementById("newAccountCardNumber").value;
  const cardNumber = rawCardNumber.replace(/[\s-]/g, "");
  const ibanRaw = document.getElementById("newAccountIban").value.replace(/\s+/g, "").toUpperCase();
  const iban = (ibanRaw.match(/.{1,4}/g) || []).join(" ");
  const currency = document.getElementById("newAccountCurrency").value;
  const balance = Number(document.getElementById("newAccountBalance").value);
  const expiry = document.getElementById("newAccountExpiry").value;
  const name = document.getElementById("newAccountName").value.trim();
  if (!name || name.length > 50) return showMessage(message, "Enter an account name up to 50 characters.");
  if (isIban ? !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(ibanRaw) : !/^\d{12,19}$/.test(cardNumber)) return showMessage(message, isIban ? "Enter a fictional IBAN in the standard letter and digit format." : "Use a fictional card number with 12 to 19 digits.");
  if (!Number.isFinite(balance) || balance < 0 || balance > 1_000_000) return showMessage(message, "The opening balance must be from 0 to 1,000,000.");
  if (!["USD", "EUR", "GBP"].includes(currency)) return showMessage(message, "Choose USD, EUR, or GBP.");
  if (!isIban) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(expiry)) return showMessage(message, "Choose a valid card expiration month.");
    const [year, month] = expiry.split("-").map(Number);
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth()+1)) return showMessage(message, "The card expiration must be this month or later.");
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, "users", uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("The selected client account no longer exists.");
      const profile = snap.data();
      const accounts = normalizeAccounts(profile);
      if (isIban ? accounts.some(account => String(account.iban || "").replace(/\s/g, "").toUpperCase() === ibanRaw) : accounts.some(account => String(account.cardNumber || "").replace(/\D/g, "") === cardNumber)) throw new Error(isIban ? "That demo IBAN is already assigned to this client." : "That fictional card number is already assigned to this client.");
      accounts.push({
        id: crypto.randomUUID(),
        name,
        type: document.getElementById("newAccountType").value,
        currency,
        balance: Math.round(balance * 100) / 100,
        cardNumber: isIban ? "" : cardNumber,
        cardLast4: isIban ? "" : cardNumber.slice(-4),
        cardExpiry: isIban ? "" : expiry,
        iban: isIban ? iban : ""
      });
      const update = { accounts, updatedAt: serverTimestamp() };
      const primary = accounts.find(account => account.id === "checking");
      if (primary) update.checkingBalance = primary.balance;
      tx.update(ref, update);
    });
    event.target.reset();
    document.getElementById("newAccountType").dispatchEvent(new Event("change"));
    document.getElementById("newAccountBalance").value = "0.00";
    showMessage(message, isIban ? "Demo IBAN account added." : "Demo account and linked card added.", "success");
    const updated = await getDoc(doc(db, "users", uid));
    if (updated.exists()) renderAdminAccounts(uid, normalizeAccounts(updated.data()));
    await loadClients();
  } catch (error) { showMessage(message, friendlyError(error)); }
  finally { button.disabled = false; }
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
      const accounts = normalizeAccounts(accountSnapshot.data()).map(account => account.id === "checking" ? { ...account, balance: updatedBalance } : account);
      firestoreTransaction.update(accountRef, { checkingBalance: updatedBalance, accounts, updatedAt: serverTimestamp() });
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
    const updatedAccount = await getDoc(doc(db, "users", uid));
    if (updatedAccount.exists()) renderAdminAccounts(uid, normalizeAccounts(updatedAccount.data()));
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
document.getElementById("clientSearch").addEventListener("input", event => {
  const search = event.target.value.trim().toLowerCase();
  document.querySelectorAll(".client-list-row").forEach(row => {
    row.classList.toggle("hidden", !row.dataset.search.includes(search));
  });
});
document.getElementById("closeBalanceEditor").addEventListener("click", () => document.getElementById("balanceEditor").classList.add("hidden"));

function showSignedOutView() {
  stopClientProfileListener();
  stopClientTransactionsListener();
  document.getElementById("bankingApp").classList.add("hidden");
  document.getElementById("publicSite").classList.remove("hidden");
  document.querySelectorAll(".public-screen").forEach(screen => screen.classList.toggle("hidden", screen.id !== "publicHome"));
  document.getElementById("loginForm").reset();
  authMessage.classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleLogout(button) {
  if (!auth?.currentUser) {
    showSignedOutView();
    return;
  }
  const previousHtml = button?.innerHTML;
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    await signOut(auth);
    showSignedOutView();
  } catch (error) {
    window.showToast?.(`Could not log out: ${friendlyError(error)}`);
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (previousHtml !== undefined) button.innerHTML = previousHtml;
    }
  }
}

document.getElementById("adminLogout").addEventListener("click", event => handleLogout(event.currentTarget));
window.firebaseLogout = () => handleLogout(document.getElementById("logout"));

if (!firebaseReady) {
  console.info("Firebase setup needed: edit firebase-config.js before enabling authentication.");
} else {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getFirestore(firebaseApp);
  functions = getFunctions(firebaseApp, "europe-west2");
  onAuthStateChanged(auth, async user => {
    if (!user) {
      showSignedOutView();
      return;
    }
    try { setPortal(await resolveRole(user)); }
    catch (error) { showMessage(authMessage, friendlyError(error)); await signOut(auth); }
  });
}
