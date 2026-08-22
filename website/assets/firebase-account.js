import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBokXocA5PfRjwShfcrmZ9R2A_vLBklTAA",
  authDomain: "gen-lang-client-0321087169.firebaseapp.com",
  projectId: "gen-lang-client-0321087169",
  storageBucket: "gen-lang-client-0321087169.firebasestorage.app",
  messagingSenderId: "391620173227",
  appId: "1:391620173227:web:a1b275568ab510c53d86ee",
};

export const auth = getAuth(initializeApp(firebaseConfig));

export function observeAccount(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function registerAccount(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(credential.user, { url: `${window.location.origin}/account/`, handleCodeInApp: false });
  return credential.user;
}

export async function loginAccount(email, password) {
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function resendVerification() {
  if (!auth.currentUser) throw new Error("Nessun account collegato.");
  await sendEmailVerification(auth.currentUser, { url: `${window.location.origin}/account/`, handleCodeInApp: false });
}

export async function refreshAccount() {
  if (!auth.currentUser) return null;
  await reload(auth.currentUser);
  return auth.currentUser;
}

export async function resetAccountPassword(email) {
  await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/account/` });
}

export function logoutAccount() {
  return signOut(auth);
}

export async function accountApi(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Accedi prima di continuare.");
  const token = await user.getIdToken(true);
  const response = await fetch(`/api/licensing${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita.");
  return payload;
}

export function friendlyAuthError(error) {
  const code = String(error?.code ?? "");
  if (code.includes("email-already-in-use")) return "Esiste già un account con questa email. Usa Accedi.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email o password non corrette.";
  if (code.includes("weak-password")) return "Scegli una password di almeno 8 caratteri.";
  if (code.includes("invalid-email")) return "Inserisci un indirizzo email valido.";
  if (code.includes("too-many-requests")) return "Troppi tentativi. Attendi qualche minuto e riprova.";
  return error?.message || "Operazione non riuscita.";
}
